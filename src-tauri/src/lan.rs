use crate::error::{AppError, AppResult};
use crate::ollama_client::OllamaClient;
use crate::types::AppSettings;
use futures_util::{StreamExt, stream};
use get_if_addrs::{IfAddr, get_if_addrs};
use serde::Serialize;
use std::collections::HashSet;
use std::net::Ipv4Addr;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

const OLLAMA_PORT: u16 = 11434;
const DEFAULT_MAX_NETWORKS: usize = 4;
const DEFAULT_MAX_TARGETS: usize = 1_024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanNetwork {
    pub interface_name: String,
    pub cidr: String,
    pub address: String,
}

#[derive(Clone, Debug)]
pub struct LanTarget {
    pub endpoint: String,
    pub ip: String,
}

#[derive(Clone, Debug)]
pub struct LanScanPlan {
    pub networks: Vec<LanNetwork>,
    pub targets: Vec<LanTarget>,
    pub self_addresses: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct DiscoveredOllamaEndpoint {
    pub endpoint: String,
    pub ip: String,
    pub version: String,
}

pub fn create_lan_scan_plan() -> AppResult<LanScanPlan> {
    let interfaces = get_if_addrs().map_err(|error| {
        AppError::message(format!("Could not inspect network interfaces: {error}"))
    })?;
    let mut candidates = Vec::<(LanNetwork, u32, u32)>::new();
    let mut self_addresses = HashSet::new();
    let mut seen_networks = HashSet::new();

    for interface in interfaces {
        let IfAddr::V4(ref address) = interface.addr else {
            continue;
        };
        if interface.is_loopback() || !is_private_ipv4(address.ip) {
            continue;
        }
        self_addresses.insert(address.ip.to_string());
        let prefix = netmask_prefix(address.netmask);
        let effective_prefix = prefix.max(24);
        if effective_prefix >= 31 {
            continue;
        }
        let mask = mask_from_prefix(effective_prefix);
        let address_value = u32::from(address.ip);
        let network_value = address_value & mask;
        let broadcast_value = network_value | !mask;
        let cidr = format!("{}/{}", Ipv4Addr::from(network_value), effective_prefix);
        if !seen_networks.insert(cidr.clone()) {
            continue;
        }
        candidates.push((
            LanNetwork {
                interface_name: interface.name,
                cidr,
                address: address.ip.to_string(),
            },
            network_value,
            broadcast_value,
        ));
    }

    candidates.sort_by(|left, right| {
        private_address_priority(&left.0.address)
            .cmp(&private_address_priority(&right.0.address))
            .then_with(|| left.0.interface_name.cmp(&right.0.interface_name))
    });

    let mut networks = Vec::new();
    let mut targets = Vec::new();
    for (network, start, broadcast) in candidates.into_iter().take(DEFAULT_MAX_NETWORKS) {
        if targets.len() >= DEFAULT_MAX_TARGETS {
            break;
        }
        networks.push(network.clone());
        for value in (start + 1)..broadcast {
            if targets.len() >= DEFAULT_MAX_TARGETS {
                break;
            }
            let ip = Ipv4Addr::from(value).to_string();
            targets.push(LanTarget {
                endpoint: format!("http://{ip}:{OLLAMA_PORT}"),
                ip,
            });
        }
    }
    Ok(LanScanPlan {
        networks,
        targets,
        self_addresses: self_addresses.into_iter().collect(),
    })
}

pub async fn discover_lan_ollama(
    plan: &LanScanPlan,
    settings: &AppSettings,
    on_progress: Arc<dyn Fn(usize, usize) + Send + Sync>,
) -> Vec<DiscoveredOllamaEndpoint> {
    let concurrency = (settings.scan_concurrency * 4).clamp(16, 48);
    let total = plan.targets.len();
    let completed = Arc::new(AtomicUsize::new(0));
    let discovery_settings = discovery_settings(settings);
    let mut discovered: Vec<DiscoveredOllamaEndpoint> = stream::iter(plan.targets.clone())
        .map(|target| {
            let settings = discovery_settings.clone();
            let completed = completed.clone();
            let on_progress = on_progress.clone();
            async move {
                let result = OllamaClient::new(target.endpoint.clone(), settings)
                    .probe_version()
                    .await
                    .ok()
                    .map(|version| DiscoveredOllamaEndpoint {
                        endpoint: target.endpoint,
                        ip: target.ip,
                        version,
                    });
                let count = completed.fetch_add(1, Ordering::Relaxed) + 1;
                on_progress(count, total);
                result
            }
        })
        .buffer_unordered(concurrency)
        .filter_map(async move |value| value)
        .collect()
        .await;
    discovered.sort_by_key(|value| {
        value
            .ip
            .parse::<Ipv4Addr>()
            .map(u32::from)
            .unwrap_or_default()
    });
    discovered
}

pub async fn discover_localhost_ollama(
    settings: &AppSettings,
    on_progress: Arc<dyn Fn(usize, usize) + Send + Sync>,
) -> Vec<DiscoveredOllamaEndpoint> {
    let targets = [
        LanTarget {
            endpoint: format!("http://127.0.0.1:{OLLAMA_PORT}"),
            ip: "127.0.0.1".into(),
        },
        LanTarget {
            endpoint: format!("http://[::1]:{OLLAMA_PORT}"),
            ip: "::1".into(),
        },
    ];
    let settings = discovery_settings(settings);
    for (index, target) in targets.into_iter().enumerate() {
        let version = OllamaClient::new(target.endpoint.clone(), settings.clone())
            .probe_version()
            .await;
        on_progress(index + 1, 2);
        if let Ok(version) = version {
            return vec![DiscoveredOllamaEndpoint {
                endpoint: target.endpoint,
                ip: target.ip,
                version,
            }];
        }
    }
    Vec::new()
}

fn discovery_settings(settings: &AppSettings) -> AppSettings {
    AppSettings {
        connect_timeout_ms: settings.connect_timeout_ms.min(800),
        request_timeout_ms: settings.request_timeout_ms.min(1_500),
        max_response_bytes: settings.max_response_bytes.min(64 * 1024),
        allow_private_networks: true,
        ..settings.clone()
    }
}

pub fn is_private_ipv4(address: Ipv4Addr) -> bool {
    address.is_private()
}

fn private_address_priority(address: &str) -> u8 {
    if address.starts_with("192.168.") {
        0
    } else if address.starts_with("10.") {
        1
    } else {
        2
    }
}

fn netmask_prefix(netmask: Ipv4Addr) -> u32 {
    u32::from(netmask).leading_ones()
}

fn mask_from_prefix(prefix: u32) -> u32 {
    if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_private_ipv4_ranges() {
        assert!(is_private_ipv4("192.168.1.2".parse().unwrap()));
        assert!(is_private_ipv4("10.10.0.2".parse().unwrap()));
        assert!(is_private_ipv4("172.20.1.2".parse().unwrap()));
        assert!(!is_private_ipv4("198.51.100.2".parse().unwrap()));
    }

    #[test]
    fn calculates_contiguous_netmask_prefix() {
        assert_eq!(netmask_prefix("255.255.255.0".parse().unwrap()), 24);
        assert_eq!(netmask_prefix("255.255.0.0".parse().unwrap()), 16);
    }
}

use crate::types::{BenchmarkStatus, ServerRecord};

pub fn create_server_export_csv(servers: &[ServerRecord], model_name: Option<&str>) -> String {
    let speed_heading = model_name
        .map(|name| format!("TPS ({name})"))
        .unwrap_or_else(|| "Best TPS".into());
    let mut output = String::from("\u{feff}");
    output.push_str(&csv_row(&["Endpoint", "Region", &speed_heading]));
    output.push_str("\r\n");
    for server in servers {
        let region = [server.city.as_deref(), server.country.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ");
        let speed = speed_for_export(server, model_name)
            .map(|value| format!("{value:.1}"))
            .unwrap_or_default();
        output.push_str(&csv_row(&[&server.endpoint, &region, &speed]));
        output.push_str("\r\n");
    }
    output
}

fn speed_for_export(server: &ServerRecord, model_name: Option<&str>) -> Option<f64> {
    let installed = server.models.iter().filter(|model| model.installed);
    if let Some(name) = model_name {
        return installed
            .filter(|model| model.name.eq_ignore_ascii_case(name.trim()))
            .flat_map(|model| &model.benchmarks)
            .find(|result| result.status == BenchmarkStatus::Success)
            .and_then(|result| result.tokens_per_second);
    }
    installed
        .flat_map(|model| &model.benchmarks)
        .filter(|result| result.status == BenchmarkStatus::Success)
        .filter_map(|result| result.tokens_per_second)
        .reduce(f64::max)
}

fn csv_row(values: &[&str]) -> String {
    values
        .iter()
        .map(|value| {
            let protected = if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                format!("'{value}")
            } else {
                (*value).to_string()
            };
            format!("\"{}\"", protected.replace('"', "\"\""))
        })
        .collect::<Vec<_>>()
        .join(",")
}

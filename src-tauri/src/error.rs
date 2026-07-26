use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Url(#[from] url::ParseError),
    #[error("{0}")]
    Network(#[from] reqwest::Error),
    #[error("{0}")]
    Csv(#[from] csv::Error),
}

impl AppError {
    pub fn message(value: impl Into<String>) -> Self {
        Self::Message(value.into())
    }
}

pub type AppResult<T> = Result<T, AppError>;

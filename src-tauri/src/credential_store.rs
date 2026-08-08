use keyring::v1::{Entry, Error};

const SERVICE_NAME: &str = "ai.shotlyx.domainbuddy.credentials";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, provider).map_err(|error| format!("无法连接系统凭证库：{error}"))
}

pub(crate) fn load(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法从系统凭证库读取密钥：{error}")),
    }
}

pub(crate) fn save(provider: &str, secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("不能保存空密钥".to_string());
    }

    entry(provider)?
        .set_password(secret.trim())
        .map_err(|error| format!("无法写入系统凭证库：{error}"))
}

pub(crate) fn delete(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法从系统凭证库删除密钥：{error}")),
    }
}

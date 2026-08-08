import type { ProviderKey, ProviderOption } from "./types";

export const providerOptions: ProviderOption[] = [
  {
    value: "tencent",
    label: "腾讯云 DNSPod",
    shortLabel: "DNSPod",
    status: "已支持",
    endpoint: "https://dnspod.tencentcloudapi.com",
    secretIdLabel: "SecretId",
    secretIdPlaceholder: "AKID...",
    secretKeyLabel: "SecretKey",
    secretKeyPlaceholder: "创建时展示一次的 SecretKey",
    regionLabel: "Region",
    regionPlaceholder: "通常可留空",
  },
  {
    value: "cloudflare",
    label: "Cloudflare",
    shortLabel: "Cloudflare",
    status: "已支持",
    endpoint: "https://api.cloudflare.com/client/v4",
    secretIdLabel: "Account ID",
    secretIdPlaceholder: "可选，留空也可以",
    secretKeyLabel: "API Token",
    secretKeyPlaceholder: "需要 Zone Read / DNS Edit 权限",
    regionLabel: "Region",
    regionPlaceholder: "Cloudflare 可留空",
  },
  {
    value: "volcengine",
    label: "火山引擎 DNS",
    shortLabel: "Volc",
    status: "已支持",
    endpoint: "https://dns.volcengineapi.com",
    secretIdLabel: "AccessKeyId",
    secretIdPlaceholder: "AKLT...",
    secretKeyLabel: "SecretAccessKey",
    secretKeyPlaceholder: "火山引擎访问密钥",
    regionLabel: "Region",
    regionPlaceholder: "默认 cn-beijing",
  },
  {
    value: "aliyun",
    label: "阿里云 DNS",
    shortLabel: "Aliyun",
    status: "配置预留",
    endpoint: "https://alidns.aliyuncs.com",
    secretIdLabel: "AccessKeyId",
    secretIdPlaceholder: "LTAI...",
    secretKeyLabel: "AccessKeySecret",
    secretKeyPlaceholder: "阿里云访问密钥",
    regionLabel: "Region",
    regionPlaceholder: "例如 cn-hangzhou",
  },
];

export function providerMeta(provider: ProviderKey): ProviderOption {
  return providerOptions.find((item) => item.value === provider) || providerOptions[0];
}

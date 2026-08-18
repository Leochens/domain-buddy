export type RecordTypeDefinition = {
  value: string;
  label: string;
  purpose: string;
  valueHelp: string;
  example: string;
};

export const recordTypeDefinitions: RecordTypeDefinition[] = [
  {
    value: "A",
    label: "IPv4 地址",
    purpose: "把主机名指向一个 IPv4 地址，常用于网站、接口或服务器。",
    valueHelp: "填写 IPv4 地址，不要带 http://、端口或路径。",
    example: "203.0.113.10",
  },
  {
    value: "AAAA",
    label: "IPv6 地址",
    purpose: "把主机名指向一个 IPv6 地址，是 A 记录的 IPv6 版本。",
    valueHelp: "填写完整 IPv6 地址，不要带协议、端口或路径。",
    example: "2001:db8::10",
  },
  {
    value: "CNAME",
    label: "主机别名",
    purpose: "把一个主机名设为另一个主机名的别名，常用于 CDN 或第三方托管服务。",
    valueHelp: "填写目标主机名，不要填写 IP、协议或路径；根域名通常不建议使用。",
    example: "target.example.net",
  },
  {
    value: "TXT",
    label: "文本验证与策略",
    purpose: "保存文本信息，常用于域名所有权验证、SPF、DKIM 和其他安全策略。",
    valueHelp: "按服务商提供的原文填写；是否需要引号以 DNS 供应商要求为准。",
    example: "v=spf1 include:_spf.example.net ~all",
  },
  {
    value: "MX",
    label: "邮件服务器",
    purpose: "指定接收该域名邮件的服务器；需要同时设置 MX 优先级。",
    valueHelp: "填写邮件服务器的主机名，不能直接填写 IP；优先级数字越小越优先。",
    example: "mail.example.net",
  },
  {
    value: "NS",
    label: "权威 DNS 服务器",
    purpose: "指定域名或子域名的权威 DNS 服务器，常用于把子域委派给其他 DNS 服务。",
    valueHelp: "填写权威 DNS 服务器主机名；修改根域 NS 前请确认不会中断现有解析。",
    example: "ns1.example.net",
  },
  {
    value: "CAA",
    label: "证书机构限制",
    purpose: "限制哪些证书颁发机构可以为域名签发 TLS 证书。",
    valueHelp: "通常由标志位、标签和证书机构域名组成。",
    example: '0 issue "letsencrypt.org"',
  },
  {
    value: "SRV",
    label: "服务与端口发现",
    purpose: "描述某项服务所在的主机和端口，常用于 SIP、即时通讯和服务发现。",
    valueHelp: "通常填写优先级、权重、端口和目标主机名，具体格式以供应商要求为准。",
    example: "10 5 443 service.example.net",
  },
  {
    value: "HTTPS",
    label: "HTTPS 服务参数",
    purpose: "发布 HTTPS 服务的连接参数，可声明目标、协议、端口和 IP 提示。",
    valueHelp: "通常由优先级、目标主机和参数组成；请直接使用服务商提供的内容。",
    example: '1 . alpn="h2,h3"',
  },
  {
    value: "SVCB",
    label: "通用服务绑定",
    purpose: "通用的服务绑定记录，用于发现服务端点；HTTPS 记录建立在它之上。",
    valueHelp: "通常由优先级、目标主机和服务参数组成。",
    example: '1 svc.example.net alpn="h2" port="8443"',
  },
];

export const recordTypes = recordTypeDefinitions.map((definition) => definition.value);

export function recordTypeDefinition(type: string) {
  return (
    recordTypeDefinitions.find((definition) => definition.value === type) || {
      value: type,
      label: "供应商记录类型",
      purpose: "该记录类型由当前 DNS 供应商返回，请按供应商文档确认用途。",
      valueHelp: "请按 DNS 供应商要求填写记录值。",
      example: "",
    }
  );
}

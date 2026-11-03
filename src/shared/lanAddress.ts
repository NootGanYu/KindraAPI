export interface NetworkAddressEntry {
  name: string
  address: string
  internal?: boolean
  family?: string | number
}

const VIRTUAL_ADAPTER =
  /(utun|tun|tap|wintun|wireguard|openvpn|tailscale|zerotier|clash|vpn|ppp|awdl|llw|bridge|gif|stf|docker|veth|vmnet|virtualbox|hyper-?v|vethernet)/i

const PHYSICAL_ADAPTER =
  /^(en\d+|eth\d*|ethernet|wlan\d*|wi-?fi|wlp\d+|以太网|本地连接|无线网络连接|无线局域网)/i

function ipv4Octets(address: string): number[] | null {
  const octets = address.split('.').map(Number)
  return octets.length === 4 &&
    octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? octets
    : null
}

/** RFC1918 私有内网地址。 */
export function isPrivateIpv4(address: string): boolean {
  const octets = ipv4Octets(address)
  if (!octets) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** 不能作为局域网分享地址的网段：回环、链路本地、CGNAT、Clash TUN 等。 */
function isExcludedIpv4(address: string): boolean {
  const octets = ipv4Octets(address)
  if (!octets) return true
  const [a, b] = octets
  if (a === 0 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 192 && b === 0 && octets[2] === 0) return true
  return false
}

function isVirtualAdapter(name: string): boolean {
  return VIRTUAL_ADAPTER.test(name) || /^lo\d*$/i.test(name)
}

function adapterScore(entry: NetworkAddressEntry): number {
  let score = 0
  if (isVirtualAdapter(entry.name)) score -= 200
  else if (PHYSICAL_ADAPTER.test(entry.name)) score += 100
  if (isPrivateIpv4(entry.address)) score += 50
  if (isExcludedIpv4(entry.address)) score -= 500
  return score
}

function isIpv4(entry: NetworkAddressEntry): boolean {
  const family = String(entry.family)
  return family === 'IPv4' || family === '4'
}

/**
 * 选择用于局域网分享的本机地址。
 * 优先私有网段上的物理网卡；排除 VPN、Clash/Tailscale 等虚拟网卡与保留网段。
 */
export function pickLanAddress(entries: NetworkAddressEntry[]): string {
  const candidates = entries.filter(
    (entry) => !entry.internal && isIpv4(entry) && !isExcludedIpv4(entry.address)
  )
  const ranked = [...candidates].sort((a, b) => adapterScore(b) - adapterScore(a))
  const chosen =
    ranked.find((entry) => !isVirtualAdapter(entry.name) && isPrivateIpv4(entry.address)) ??
    ranked.find((entry) => !isVirtualAdapter(entry.name)) ??
    ranked[0]
  if (chosen) return chosen.address

  // 全部候选都被排除时，至少退回一个非虚拟的 IPv4，避免直接不可访问。
  const all = entries.filter((entry) => !entry.internal && isIpv4(entry))
  return (all.find((entry) => !isVirtualAdapter(entry.name)) ?? all[0])?.address ?? '127.0.0.1'
}

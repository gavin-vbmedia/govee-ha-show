"""Find Govee devices with LAN Control enabled via the multicast scan."""
import asyncio
import json
import logging
import socket

from .protocol import GOVEE_MCAST, REPLY_PORT, SCAN_PORT, scan_msg

log = logging.getLogger(__name__)
_lock = asyncio.Lock()


class _Collector(asyncio.DatagramProtocol):
    def __init__(self):
        self.found = {}

    def datagram_received(self, data, addr):
        try:
            d = json.loads(data)["msg"]["data"]
        except (ValueError, KeyError, TypeError):
            return
        if isinstance(d, dict) and d.get("ip"):
            self.found[d.get("device") or d["ip"]] = d


def _reply_socket() -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("", REPLY_PORT))
    s.setblocking(False)
    return s


async def scan(timeout: float = 3.0) -> list[dict]:
    """Return scan replies: dicts with ip, device, sku, bleVersionHard, ..."""
    async with _lock:
        loop = asyncio.get_running_loop()
        transport, proto = await loop.create_datagram_endpoint(_Collector, sock=_reply_socket())
        tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            tx.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            # Send twice: UDP multicast on busy Wi-Fi drops the odd packet.
            for _ in range(2):
                tx.sendto(scan_msg(), (GOVEE_MCAST, SCAN_PORT))
                await asyncio.sleep(timeout / 2)
        except OSError as e:
            log.warning("scan failed: %s", e)
        finally:
            tx.close()
            transport.close()
    return sorted(proto.found.values(), key=lambda d: socket.inet_aton(d["ip"]))

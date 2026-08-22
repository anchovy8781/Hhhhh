"""Transport implementations and the URL factory that picks between them.

Device URLs
-----------
``sim://psu?channels=3&load=10``   in-process simulator (default device)
``tcp://192.168.0.10:5025``        LAN / LXI instrument
``serial:///dev/ttyUSB0?baud=9600``  USB or RS-232 instrument
``COM3`` / ``/dev/ttyUSB0``        bare serial port shorthand
``10.0.0.5:5025``                  bare ``host:port`` shorthand for TCP
"""

import math
from urllib.parse import parse_qs, urlparse

from ..errors import PowerDevError
from .base import Transport
from .serial import SerialTransport
from .sim import SimTransport
from .tcp import TcpTransport

__all__ = [
    "Transport", "SimTransport", "TcpTransport", "SerialTransport",
    "open_transport", "DEFAULT_DEVICE_URL",
]

DEFAULT_DEVICE_URL = "sim://psu"
DEFAULT_TCP_PORT = 5025


def _flatten(query):
    return {key: values[-1] for key, values in parse_qs(query).items()}


def _as_float(params, *names, default=None):
    for name in names:
        if name in params:
            word = params[name].strip().upper()
            if word in ("INF", "OPEN"):
                return math.inf
            return float(params[name])
    return default


def _as_int(params, *names, default=None):
    value = _as_float(params, *names, default=None)
    return default if value is None else int(value)


def _preset(supply, params):
    """Give a fresh simulator a starting state, e.g. ``sim://psu?v=5&on=1``.

    Each process gets its own simulator, so without this every CLI call would
    start from 0 V with the outputs off.
    """
    voltage = _as_float(params, "voltage", "v")
    current = _as_float(params, "current", "i")
    output = params.get("on", params.get("output"))
    for channel in supply.channels:
        if voltage is not None:
            channel.voltage_set = min(voltage, channel.max_voltage)
        if current is not None:
            channel.current_set = min(current, channel.max_current)
        if output is not None:
            channel.output = str(output).strip().lower() in ("1", "on", "true", "yes")


def open_transport(url=None, timeout=2.0, connect=True):
    """Build (and by default open) the transport described by ``url``."""
    url = url or DEFAULT_DEVICE_URL
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()

    if not scheme:
        # Shorthand: "host:port" is TCP, anything else is a serial port name.
        host, sep, port = url.rpartition(":")
        if sep and port.isdigit():
            transport = TcpTransport(host, int(port), timeout=timeout)
        else:
            transport = SerialTransport(url, timeout=timeout)
        return transport.open() if connect else transport

    params = _flatten(parsed.query)
    timeout = _as_float(params, "timeout", default=timeout)

    if scheme == "sim":
        transport = SimTransport(
            timeout=timeout,
            channels=_as_int(params, "channels", "ch", default=3),
            load_ohms=_as_float(params, "load", "load_ohms", default=10.0),
            max_voltage=_as_float(params, "max_voltage", "vmax", default=32.0),
            max_current=_as_float(params, "max_current", "imax", default=3.2),
        )
        _preset(transport.supply, params)
    elif scheme in ("tcp", "lxi", "socket"):
        if not parsed.hostname:
            raise PowerDevError("no host in device URL: {}".format(url))
        transport = TcpTransport(
            parsed.hostname, parsed.port or DEFAULT_TCP_PORT, timeout=timeout)
    elif scheme in ("serial", "usb", "asrl"):
        port = parsed.path if parsed.path and not parsed.netloc else (
            parsed.netloc + parsed.path)
        if not port:
            raise PowerDevError("no port in device URL: {}".format(url))
        transport = SerialTransport(
            port, baudrate=_as_int(params, "baud", "baudrate", default=115200),
            timeout=timeout)
    else:
        raise PowerDevError(
            "unsupported device URL scheme '{}' (use sim://, tcp:// or serial://)"
            .format(scheme))

    return transport.open() if connect else transport

"""powerdev -- a developer tool for programmable power devices.

Typical use::

    from powerdev import PowerSupply

    with PowerSupply.connect("sim://psu") as psu:
        psu[1].configure(voltage=3.3, current=0.5).on()
        print(psu[1].measure())
"""

__version__ = "0.1.0"

from .clock import Clock, FakeClock
from .device import Channel, ChannelStatus, PowerSupply, Reading
from .errors import (
    DeviceError, PowerDevError, ProtectionTripped, SequenceError, TransportError,
)
from .monitor import Monitor, summarize
from .scpi import ScpiClient
from .sequence import SequenceRunner, load_sequence, run_sequence
from .simulator import SimulatedSupply
from .transports import open_transport

__all__ = [
    "__version__",
    "PowerSupply", "Channel", "ChannelStatus", "Reading",
    "Monitor", "summarize",
    "SequenceRunner", "run_sequence", "load_sequence",
    "ScpiClient", "SimulatedSupply", "open_transport",
    "Clock", "FakeClock",
    "PowerDevError", "TransportError", "DeviceError", "ProtectionTripped",
    "SequenceError",
]

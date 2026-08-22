"""In-process transport backed by :class:`~powerdev.simulator.SimulatedSupply`."""

from collections import deque

from ..errors import TransportError
from ..simulator import SimulatedSupply
from .base import Transport


class SimTransport(Transport):
    """Speak SCPI to a simulated instrument, no hardware and no sockets."""

    def __init__(self, supply=None, timeout=2.0, **supply_kwargs):
        super().__init__(timeout=timeout)
        self.supply = supply if supply is not None else SimulatedSupply(**supply_kwargs)
        self.name = "sim://{}".format(self.supply.model.lower())
        self._responses = deque()

    def _open_impl(self):
        self._responses.clear()

    def _close_impl(self):
        self._responses.clear()

    def write_raw(self, data):
        text = data.decode(self.encoding, "replace")
        for line in text.splitlines():
            if not line.strip():
                continue
            response = self.supply.execute(line)
            if response is not None:
                self._responses.append(response)

    def read_raw_line(self):
        if not self._responses:
            raise TransportError(
                "timed out after {}s waiting for a response from {}".format(
                    self.timeout, self.name)
            )
        return self._responses.popleft().encode(self.encoding)

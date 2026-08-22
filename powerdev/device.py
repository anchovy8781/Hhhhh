"""High level device objects: a supply, its channels and their readings."""

from dataclasses import asdict, dataclass, field

from . import drivers as driver_registry
from .clock import SYSTEM_CLOCK
from .errors import DeviceError, PowerDevError, ProtectionTripped, TransportError
from .scpi import ScpiClient
from .transports import open_transport


@dataclass(frozen=True)
class Reading:
    """One instantaneous measurement of a channel."""

    channel: int
    voltage: float
    current: float
    power: float
    timestamp: float = 0.0
    mode: str = ""

    def as_dict(self):
        return asdict(self)

    def __str__(self):
        text = "CH{}: {:7.3f} V  {:7.3f} A  {:8.3f} W".format(
            self.channel, self.voltage, self.current, self.power)
        return "{}  [{}]".format(text, self.mode) if self.mode else text


@dataclass
class ChannelStatus:
    """Setpoints plus a live reading, i.e. what ``powerdev status`` prints."""

    channel: int
    output: bool
    voltage_set: float
    current_limit: float
    reading: Reading = field(default=None)

    def as_dict(self):
        data = {
            "channel": self.channel,
            "output": self.output,
            "voltage_set": self.voltage_set,
            "current_limit": self.current_limit,
        }
        if self.reading is not None:
            data["measured"] = self.reading.as_dict()
        return data


class Channel:
    """One output of a :class:`PowerSupply`."""

    def __init__(self, supply, index):
        self.supply = supply
        self.index = index

    # -- setpoints --------------------------------------------------------
    @property
    def voltage_setpoint(self):
        return self.supply.client.query_float(
            self.supply.driver.get_voltage(self.index))

    @property
    def current_limit(self):
        return self.supply.client.query_float(
            self.supply.driver.get_current(self.index))

    def set_voltage(self, volts):
        self.supply.client.write(self.supply.driver.set_voltage(self.index, volts))
        return self

    def set_current(self, amps):
        self.supply.client.write(self.supply.driver.set_current(self.index, amps))
        return self

    def configure(self, voltage=None, current=None, ovp=None, ocp=None):
        """Apply several settings in one call; ``None`` leaves a value alone."""
        if voltage is not None:
            self.set_voltage(voltage)
        if current is not None:
            self.set_current(current)
        if ovp is not None:
            self.set_ovp(ovp)
        if ocp is not None:
            self.set_ocp(ocp)
        return self

    # -- output -----------------------------------------------------------
    @property
    def output(self):
        return self.supply.client.query_bool(
            self.supply.driver.get_output(self.index))

    def on(self):
        self.supply.client.write(self.supply.driver.set_output(self.index, True))
        return self

    def off(self):
        self.supply.client.write(self.supply.driver.set_output(self.index, False))
        return self

    def set_output(self, state):
        return self.on() if state else self.off()

    # -- protection -------------------------------------------------------
    def set_ovp(self, volts, enable=True):
        client, driver = self.supply.client, self.supply.driver
        client.write(driver.set_ovp(self.index, volts))
        client.write(driver.set_ovp_state(self.index, enable))
        return self

    def set_ocp(self, amps, enable=True):
        client, driver = self.supply.client, self.supply.driver
        client.write(driver.set_ocp(self.index, amps))
        client.write(driver.set_ocp_state(self.index, enable))
        return self

    def protection_tripped(self):
        """Return ``"ovp"``, ``"ocp"`` or ``None``."""
        client, driver = self.supply.client, self.supply.driver
        if client.query_bool(driver.get_ovp_tripped(self.index)):
            return "ovp"
        if client.query_bool(driver.get_ocp_tripped(self.index)):
            return "ocp"
        return None

    def clear_protection(self):
        self.supply.client.write(
            self.supply.driver.clear_protection(self.index))
        return self

    def raise_if_tripped(self):
        kind = self.protection_tripped()
        if kind:
            raise ProtectionTripped(
                "{} tripped on channel {}".format(kind.upper(), self.index),
                channel=self.index, kind=kind)

    # -- measurement -------------------------------------------------------
    def measure(self, timestamp=None):
        supply = self.supply
        values = supply._measure_values(self.index)
        voltage, current = values[0], values[1]
        power = values[2] if len(values) > 2 else voltage * current
        return Reading(
            channel=self.index,
            voltage=voltage,
            current=current,
            power=power,
            timestamp=supply.clock.wall() if timestamp is None else timestamp,
            mode=supply._mode(self.index, voltage, current),
        )

    def status(self, measure=True):
        return ChannelStatus(
            channel=self.index,
            output=self.output,
            voltage_set=self.voltage_setpoint,
            current_limit=self.current_limit,
            reading=self.measure() if measure else None,
        )

    def __repr__(self):
        return "<Channel {} of {}>".format(self.index, self.supply.model)


class PowerSupply:
    """A programmable supply reached over some transport.

    Build one with :meth:`connect` (``PowerSupply.connect("sim://psu")``) and
    use it as a context manager so the link is always closed.
    """

    def __init__(self, client, driver=None, clock=SYSTEM_CLOCK, idn=None):
        self.client = client
        self.clock = clock
        self.idn = idn if idn is not None else client.idn()
        self.driver = driver or driver_registry.detect(self.idn)
        self.channels = [Channel(self, i + 1) for i in range(self.driver.channels)]
        self._measure_all_supported = True

    @classmethod
    def connect(cls, url=None, timeout=2.0, check_errors=True, clock=SYSTEM_CLOCK,
                driver=None):
        """Open ``url``, identify the instrument and pick a driver."""
        transport = open_transport(url, timeout=timeout)
        client = ScpiClient(transport, check_errors=check_errors)
        try:
            idn = client.idn()
        except PowerDevError:
            transport.close()
            raise
        return cls(client, driver=driver, clock=clock, idn=idn)

    # -- identity ----------------------------------------------------------
    @property
    def vendor(self):
        return self.idn.split(",")[0].strip() if self.idn else ""

    @property
    def model(self):
        parts = self.idn.split(",")
        return parts[1].strip() if len(parts) > 1 else "unknown"

    @property
    def channel_count(self):
        return len(self.channels)

    def channel(self, index):
        if not 1 <= index <= len(self.channels):
            raise PowerDevError(
                "channel {} out of range (instrument has {})".format(
                    index, len(self.channels)))
        return self.channels[index - 1]

    def __getitem__(self, index):
        return self.channel(index)

    def __iter__(self):
        return iter(self.channels)

    def __len__(self):
        return len(self.channels)

    # -- bulk operations ----------------------------------------------------
    def measure_all(self, channels=None):
        return [self.channel(i).measure() for i in self._resolve(channels)]

    def status(self, channels=None, measure=True):
        return [self.channel(i).status(measure=measure)
                for i in self._resolve(channels)]

    def all_outputs_off(self):
        """Best-effort shutdown: try every channel, report what failed."""
        failures = []
        for channel in self.channels:
            try:
                channel.off()
            except PowerDevError as exc:
                failures.append((channel.index, str(exc)))
        return failures

    def reset(self):
        self.client.reset()
        return self

    def _resolve(self, channels):
        if not channels:
            return [c.index for c in self.channels]
        return [int(c) for c in channels]

    # -- internals ----------------------------------------------------------
    def _measure_values(self, index):
        """Read a channel, preferring a single-round-trip combined query."""
        if self._measure_all_supported:
            command = self.driver.measure_all(index)
            if command:
                try:
                    values = self.client.query_floats(command)
                    if len(values) >= 2:
                        return values
                except (DeviceError, TransportError):
                    pass
                self._measure_all_supported = False
                self.client.clear()
        voltage = self.client.query_float(self.driver.measure_voltage(index))
        current = self.client.query_float(self.driver.measure_current(index))
        return [voltage, current, voltage * current]

    def _mode(self, index, voltage, current):
        """Report CV / CC / OFF, asking the instrument when it can tell us."""
        getter = getattr(self.driver, "get_mode", None)
        if getter is not None:
            try:
                return self.client.query(getter(index)).strip().upper()
            except (DeviceError, TransportError):
                pass
        if voltage == 0 and current == 0:
            return "OFF"
        try:
            limit = self.channel(index).current_limit
        except PowerDevError:
            return ""
        return "CC" if limit and current >= limit * 0.999 else "CV"

    # -- lifecycle -----------------------------------------------------------
    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()
        return False

    def __repr__(self):
        return "<PowerSupply {} via {} ({} ch)>".format(
            self.model, self.client.transport.name, len(self.channels))

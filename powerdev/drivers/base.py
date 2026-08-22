"""Driver base class: per-model SCPI dialect."""

import re


class Driver:
    """Builds the command strings for one family of instruments.

    Subclasses override only the pieces where their dialect differs; the
    generic SCPI forms live here.
    """

    name = "generic"
    description = "Generic SCPI power supply"
    #: Regex matched against ``*IDN?``. A ``channels`` group, when present,
    #: sets the channel count straight from the identification string.
    idn_pattern = None
    default_channels = 1
    max_voltage = None
    max_current = None

    def __init__(self, channels=None, idn=""):
        self.channels = int(channels or self.default_channels)
        self.idn = idn

    # -- detection --------------------------------------------------------
    @classmethod
    def match(cls, idn):
        """Return a configured driver for ``idn``, or ``None``."""
        if not cls.idn_pattern:
            return None
        match = re.search(cls.idn_pattern, idn, re.IGNORECASE)
        if not match:
            return None
        groups = match.groupdict()
        channels = groups.get("channels")
        return cls(channels=channels, idn=idn)

    # -- setpoints --------------------------------------------------------
    def set_voltage(self, channel, volts):
        return "SOUR{}:VOLT {:.4f}".format(channel, volts)

    def get_voltage(self, channel):
        return "SOUR{}:VOLT?".format(channel)

    def set_current(self, channel, amps):
        return "SOUR{}:CURR {:.4f}".format(channel, amps)

    def get_current(self, channel):
        return "SOUR{}:CURR?".format(channel)

    # -- output switching --------------------------------------------------
    def set_output(self, channel, on):
        return "OUTP{} {}".format(channel, "ON" if on else "OFF")

    def get_output(self, channel):
        return "OUTP{}?".format(channel)

    # -- measurement -------------------------------------------------------
    def measure_voltage(self, channel):
        return "MEAS:VOLT? CH{}".format(channel)

    def measure_current(self, channel):
        return "MEAS:CURR? CH{}".format(channel)

    def measure_all(self, channel):
        """Command returning ``volts,amps,watts`` in one round trip, or None."""
        return "MEAS:ALL? CH{}".format(channel)

    # -- protection --------------------------------------------------------
    def set_ovp(self, channel, volts):
        return "SOUR{}:VOLT:PROT {:.4f}".format(channel, volts)

    def set_ovp_state(self, channel, on):
        return "SOUR{}:VOLT:PROT:STAT {}".format(channel, "ON" if on else "OFF")

    def get_ovp_tripped(self, channel):
        return "SOUR{}:VOLT:PROT:TRIP?".format(channel)

    def set_ocp(self, channel, amps):
        return "SOUR{}:CURR:PROT {:.4f}".format(channel, amps)

    def set_ocp_state(self, channel, on):
        return "SOUR{}:CURR:PROT:STAT {}".format(channel, "ON" if on else "OFF")

    def get_ocp_tripped(self, channel):
        return "SOUR{}:CURR:PROT:TRIP?".format(channel)

    def clear_protection(self, channel):
        return "PROT{}:CLE".format(channel)

    def __repr__(self):
        return "<{} channels={}>".format(type(self).__name__, self.channels)

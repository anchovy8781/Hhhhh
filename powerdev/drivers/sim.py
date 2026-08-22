"""Driver for the built-in simulator (``sim://``)."""

from .base import Driver


class SimSupplyDriver(Driver):
    name = "sim-psu"
    description = "powerdev simulated bench supply"
    # The channel count is baked into the model name, e.g. SIM-PSU-3CH.
    idn_pattern = r"PowerDev,\s*SIM-PSU-(?P<channels>\d+)CH"
    default_channels = 3
    max_voltage = 32.0
    max_current = 3.2

    def set_load(self, channel, ohms):
        """Simulator-only: reshape the resistive load on a channel."""
        word = "INF" if ohms == float("inf") else "{:.4f}".format(ohms)
        return "SIM:LOAD{} {}".format(channel, word)

    def get_mode(self, channel):
        """Simulator-only: report CV / CC / OFF without inferring it."""
        return "SIM:MODE{}?".format(channel)

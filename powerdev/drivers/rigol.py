"""Driver for Rigol DP800-series supplies.

They speak standard SCPI for setpoints but take the channel as an argument on
output commands (``:OUTP CH1,ON``) instead of as a header suffix.
"""

from .base import Driver


class RigolDP800Driver(Driver):
    name = "rigol-dp800"
    description = "Rigol DP811/DP821/DP831/DP832 series"
    idn_pattern = r"RIGOL\s+TECHNOLOGIES\s*,\s*DP8\d\d"
    default_channels = 3
    max_voltage = 32.0
    max_current = 3.2

    def set_output(self, channel, on):
        return ":OUTP CH{},{}".format(channel, "ON" if on else "OFF")

    def get_output(self, channel):
        return ":OUTP? CH{}".format(channel)

    def measure_all(self, channel):
        return ":MEAS:ALL? CH{}".format(channel)

    def clear_protection(self, channel):
        return ":SOUR{}:VOLT:PROT:CLEAR".format(channel)

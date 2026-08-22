"""Driver registry and ``*IDN?``-based detection."""

from .base import Driver
from .rigol import RigolDP800Driver
from .sim import SimSupplyDriver

__all__ = ["Driver", "SimSupplyDriver", "RigolDP800Driver",
           "register", "registry", "detect"]

_REGISTRY = [SimSupplyDriver, RigolDP800Driver]


def register(driver_class):
    """Add a driver to the front of the detection list."""
    if driver_class not in _REGISTRY:
        _REGISTRY.insert(0, driver_class)
    return driver_class


def registry():
    """Every known driver class, most specific first, generic last."""
    return list(_REGISTRY) + [Driver]


def detect(idn, channels=None):
    """Pick a driver for an identification string.

    Falls back to the generic SCPI driver so an unknown instrument is still
    usable, just without model-specific quirks.
    """
    for driver_class in _REGISTRY:
        driver = driver_class.match(idn or "")
        if driver is not None:
            if channels:
                driver.channels = int(channels)
            return driver
    return Driver(channels=channels, idn=idn or "")

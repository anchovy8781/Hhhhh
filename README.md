# Hhhhh

전력기기(power device)를 다루는 두 가지 도구가 들어 있습니다.

| 디렉터리 | 무엇인가 | 대상 |
| --- | --- | --- |
| [`app/`](app/) | **전력기기 랩** — 재료를 골라 인덕터·변압기·솔레노이드·DC 모터를 3D로 설계하는 안드로이드 앱 (APK) | 설계·학습 |
| [`powerdev/`](#powerdev) | SCPI 전원장치(파워서플라이·전자부하)를 제어하는 파이썬 CLI/라이브러리 | 계측·시험 자동화 |

앞의 것은 **기기를 설계**하고, 뒤의 것은 **실제 장비를 구동**합니다.
APK를 받는 방법을 포함한 앱 설명은 [`app/README.md`](app/README.md)에 있습니다.

---

<a id="powerdev"></a>

## powerdev

A developer tool for programmable power devices — bench supplies and anything
else that speaks SCPI over serial, TCP, or the built-in simulator.

It gives you three things that are usually re-written from scratch in every lab
repo: a **CLI** for driving a supply by hand, a small **Python API** for driving
it from a script, and a **scripted sequence runner** with pass/fail limits so a
board bring-up becomes a file you can check into git.

Everything works with no hardware attached: `sim://` is a real SCPI
state machine with constant-voltage/constant-current crossover, latching
OVP/OCP protection and an instrument error queue.

```
$ powerdev -d "sim://psu?channels=2&load=8" set -c 1 -V 3.3 -I 0.5 --on
CH  OUT    SET V    LIM A    MEAS V    MEAS A    MEAS W  MODE
 1  ON     3.300    0.500     3.300     0.412     1.361  CV
```

## Install

```bash
pip install -e .            # core, standard library only
pip install -e '.[serial]'  # adds pyserial for serial:// links
```

Python 3.9+. The core has no dependencies; `pyserial` is imported lazily and
only when you actually open a serial port.

## Device URLs

Every command takes `-d/--device` (or the `POWERDEV_DEVICE` environment
variable). The default is `sim://psu`.

| URL | Meaning |
| --- | --- |
| `sim://psu?channels=3&load=10` | in-process simulator |
| `tcp://192.168.0.10:5025` | LAN/LXI instrument (port defaults to 5025) |
| `serial:///dev/ttyUSB0?baud=115200` | USB or RS-232 instrument |
| `192.168.0.10:5025` | shorthand for `tcp://` |
| `/dev/ttyUSB0`, `COM3` | shorthand for `serial://` |

Simulator query parameters: `channels`, `load` (ohms, or `inf` for an open
circuit), `vmax`, `imax`, and the presets `v`, `i`, `on` which give a fresh
simulator a starting state. Each process gets its own simulator, so presets are
how you make a one-shot command like `powerdev measure` see a live rail.

## Commands

```bash
powerdev id                        # identify the instrument and chosen driver
powerdev drivers                   # list known drivers
powerdev status                    # setpoints + live readings, all channels
powerdev set -c 1 -V 3.3 -I 0.5 --ovp 3.8 --on
powerdev on  -c 1                  # outputs on  (all channels if -c omitted)
powerdev off                       # outputs off
powerdev measure -c 1 --json
powerdev monitor -c 1 -i 0.5 -t 30 -o rail.csv --stats
powerdev run examples/3v3_bringup.json
powerdev scpi "SOUR1:VOLT 3.3" "MEAS:VOLT? CH1"
```

Useful global flags: `-v` traces every SCPI exchange on stderr, and
`--no-error-check` skips the `SYST:ERR?` round trip that powerdev otherwise
performs after each command (that check is what turns a silently ignored
command into a loud error).

Exit codes: `0` success, `1` error, `2` a sequence ran but failed.

### Monitoring

`monitor` samples on a schedule anchored to the start time, so slow instrument
round trips do not make the log drift. It writes CSV or JSONL (chosen from the
file extension, or `--format`) and `--stats` prints min/max/mean per channel
plus energy in watt-hours, integrated over the log.

```
$ powerdev -d "sim://psu?load=5&v=5&i=2&on=1" monitor -c 1 -n 3 -i 0.5 --stats -q
{  # abridged: the real output is one key per line
  "1": {
    "samples": 3,
    "duration_s": 1.0002,
    "voltage": {"min": 5.0, "max": 5.0, "mean": 5.0, "last": 5.0},
    "current": {"min": 1.0, "max": 1.0, "mean": 1.0, "last": 1.0},
    "power":   {"min": 5.0, "max": 5.0, "mean": 5.0, "last": 5.0},
    "energy_wh": 0.0013891
  }
}
```

## Sequences

A sequence is a JSON file (YAML too, if PyYAML is installed). See
`examples/` for runnable ones.

```json
{
  "name": "3V3 rail bring-up",
  "device": "sim://psu?channels=2&load=8",
  "steps": [
    {"op": "set",    "channel": 1, "voltage": 3.3, "current": 0.6, "ovp": 3.8},
    {"op": "output", "channel": 1, "state": "on"},
    {"op": "wait",   "seconds": 0.2},
    {"op": "check",  "channel": 1,
     "voltage": {"nominal": 3.3, "tolerance_pct": 2},
     "current": {"max": 0.5},
     "mode": "CV"}
  ]
}
```

| op | what it does |
| --- | --- |
| `set` | apply `voltage`, `current`, `ovp`, `ocp` to a channel |
| `output` | switch a channel on or off |
| `wait` | dwell for `seconds` |
| `measure` | record a reading from `channel` or `channels` |
| `check` | measure and assert limits on voltage/current/power/mode |
| `ramp` | walk the setpoint `from` → `to` over `seconds` in `steps` points |
| `reset` | `*RST` the instrument |
| `load` | reshape the simulated load (skipped on real hardware) |
| `log` | record a message in the report |

Limits accept `{"min": …}`, `{"max": …}`, `{"nominal": …, "tolerance": …}` or
`{"nominal": …, "tolerance_pct": …}`.

A failing step stops the run (`--continue-on-fail` overrides), and **every
output is switched off when the run ends** — including after a failure or an
exception. `--no-shutdown` opts out. `--json` emits the whole report,
step by step, for CI.

## Python API

```python
from powerdev import PowerSupply

with PowerSupply.connect("sim://psu?channels=2&load=8") as psu:
    print(psu.idn, psu.driver.name)

    psu[1].configure(voltage=3.3, current=0.5, ovp=3.8).on()
    reading = psu[1].measure()
    print(reading.voltage, reading.current, reading.mode)

    psu.all_outputs_off()
```

Logging and sequences are equally usable as libraries:

```python
from powerdev import Monitor, summarize, load_sequence, run_sequence

samples = Monitor(psu, channels=[1], interval=0.5, duration=10).run()
print(summarize(samples)[1]["energy_wh"])

report = run_sequence(load_sequence("examples/3v3_bringup.json"), psu)
print(report.passed)
```

## How it fits together

```
cli.py ── device.py ── scpi.py ── transports/ ── sim / tcp / serial
   │         │
   │         └── drivers/      per-model SCPI dialect, picked from *IDN?
   ├── monitor.py              sampling loop, CSV/JSONL logs, statistics
   └── sequence.py             scripted steps with pass/fail limits
```

* **Transports** move lines of text; they know nothing about SCPI.
* **`ScpiClient`** adds SCPI conventions: typed queries and the error queue.
* **Drivers** hold the per-model dialect. An unknown instrument still works
  through the generic SCPI driver; `SIM-PSU-*` and Rigol DP800 are recognised.
  Add one by subclassing `Driver`, setting `idn_pattern`, and calling
  `powerdev.drivers.register`.
* **`PowerSupply`/`Channel`** are what user code touches.
* **Clocks** are injected (`powerdev.clock.FakeClock`), which is why the test
  suite covers timed ramps and 30-second logs in milliseconds.

## Tests

```bash
python -m unittest discover -s tests
```

108 tests, no hardware, no network, no third-party packages — the simulator
stands in for the instrument, and `FakeClock` stands in for time.

## Safety notes

This drives real hardware that can damage a board under test. powerdev tries to
fail loudly rather than quietly: instrument errors are raised, not swallowed;
sequences de-energise every output when they finish; and `set` applies limits
before you turn the output on. Set `ovp`/`ocp` on anything you care about.

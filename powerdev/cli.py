"""Command line entry point: ``powerdev <command> [options]``."""

import argparse
import json
import os
import sys

from . import __version__
from .device import PowerSupply
from .drivers import registry
from .errors import PowerDevError, SequenceError
from .monitor import Monitor, make_writer, summarize
from .sequence import SequenceRunner, load_sequence
from .transports import DEFAULT_DEVICE_URL

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_FAILED = 2

STATUS_HEADER = ("CH", "OUT", "SET V", "LIM A", "MEAS V", "MEAS A", "MEAS W", "MODE")
STATUS_ROW = "{:>2}  {:<3}  {:>7}  {:>7}  {:>8}  {:>8}  {:>8}  {:<4}"


def default_device():
    return os.environ.get("POWERDEV_DEVICE", DEFAULT_DEVICE_URL)


# ---------------------------------------------------------------- helpers
def _trace(direction, text):
    print("{} {}".format(direction, text), file=sys.stderr)


def _connect(args):
    supply = PowerSupply.connect(
        args.device, timeout=args.timeout, check_errors=not args.no_error_check)
    if args.verbose:
        supply.client.trace = _trace
    return supply


def _channels(args, supply):
    if not getattr(args, "channel", None):
        return [c.index for c in supply.channels]
    return [int(c) for c in args.channel]


def _print_status_rows(statuses):
    print(STATUS_ROW.format(*STATUS_HEADER))
    for status in statuses:
        reading = status.reading
        print(STATUS_ROW.format(
            status.channel,
            "ON" if status.output else "off",
            "{:.3f}".format(status.voltage_set),
            "{:.3f}".format(status.current_limit),
            "{:.3f}".format(reading.voltage) if reading else "-",
            "{:.3f}".format(reading.current) if reading else "-",
            "{:.3f}".format(reading.power) if reading else "-",
            reading.mode if reading else ""))


# ---------------------------------------------------------------- commands
def cmd_id(args):
    with _connect(args) as supply:
        if args.json:
            print(json.dumps({
                "idn": supply.idn,
                "vendor": supply.vendor,
                "model": supply.model,
                "channels": supply.channel_count,
                "driver": supply.driver.name,
                "transport": supply.client.transport.name,
            }, indent=2))
        else:
            print("identification : {}".format(supply.idn))
            print("driver         : {} ({})".format(
                supply.driver.name, supply.driver.description))
            print("channels       : {}".format(supply.channel_count))
            print("transport      : {}".format(supply.client.transport.name))
    return EXIT_OK


def cmd_drivers(args):
    for driver_class in registry():
        print("{:<14} {:<40} channels={} idn~{}".format(
            driver_class.name, driver_class.description,
            driver_class.default_channels, driver_class.idn_pattern or "-"))
    return EXIT_OK


def cmd_status(args):
    with _connect(args) as supply:
        statuses = supply.status(_channels(args, supply), measure=not args.no_measure)
        if args.json:
            print(json.dumps([s.as_dict() for s in statuses], indent=2))
        else:
            _print_status_rows(statuses)
    return EXIT_OK


def cmd_set(args):
    with _connect(args) as supply:
        channel = supply.channel(args.channel)
        channel.configure(voltage=args.voltage, current=args.current,
                          ovp=args.ovp, ocp=args.ocp)
        if args.on:
            channel.on()
        elif args.off:
            channel.off()
        _print_status_rows([channel.status()])
    return EXIT_OK


def _switch(args, state):
    with _connect(args) as supply:
        for index in _channels(args, supply):
            supply.channel(index).set_output(state)
        _print_status_rows(supply.status(_channels(args, supply)))
    return EXIT_OK


def cmd_on(args):
    return _switch(args, True)


def cmd_off(args):
    return _switch(args, False)


def cmd_measure(args):
    with _connect(args) as supply:
        readings = supply.measure_all(_channels(args, supply))
        if args.json:
            print(json.dumps([r.as_dict() for r in readings], indent=2))
        else:
            for reading in readings:
                print(reading)
    return EXIT_OK


def cmd_monitor(args):
    stream = None
    with _connect(args) as supply:
        channels = _channels(args, supply)
        monitor = Monitor(supply, channels=channels, interval=args.interval,
                          duration=args.duration, count=args.count)
        writer = None
        if args.output:
            fmt = args.format or (
                "jsonl" if args.output.lower().endswith(".jsonl") else "csv")
            stream = open(args.output, "w", encoding="utf-8", newline="")
            writer = make_writer(fmt, stream, channels)
        samples = []
        try:
            for sample in monitor.samples():
                samples.append(sample)
                if writer is not None:
                    writer.write(sample)
                    writer.flush()
                if not args.quiet:
                    print("{:8.3f}s  {}".format(
                        sample.elapsed,
                        "  ".join(str(r) for r in sample.readings)))
        except KeyboardInterrupt:
            print("\nstopped after {} samples".format(len(samples)),
                  file=sys.stderr)
        finally:
            if stream is not None:
                stream.close()
        if args.output:
            print("wrote {} samples to {}".format(len(samples), args.output),
                  file=sys.stderr)
        if args.stats:
            print(json.dumps(
                {str(k): v for k, v in summarize(samples, channels).items()},
                indent=2))
    return EXIT_OK


def cmd_run(args):
    spec = load_sequence(args.sequence)
    device = args.device if args.device_given else spec.get("device") or args.device
    args.device = device
    with _connect(args) as supply:
        def report_step(step):
            if args.json:
                return
            print("{:>3} {:<8} {:<5} {}".format(
                step.index, step.op, step.status, step.detail))

        runner = SequenceRunner(supply, on_step=report_step)
        report = runner.run(
            spec,
            stop_on_fail=not args.continue_on_fail,
            safe_shutdown=not args.no_shutdown)
    if args.json:
        print(json.dumps(report.as_dict(), indent=2))
    else:
        print("\n{}: {} ({} steps, {:.2f}s)".format(
            report.name, "PASS" if report.passed else "FAIL",
            len(report.steps), report.duration))
        for failure in report.failures:
            print("  step {} ({}): {}".format(
                failure.index, failure.op, failure.detail))
    return EXIT_OK if report.passed else EXIT_FAILED


def cmd_scpi(args):
    with _connect(args) as supply:
        client = supply.client
        for command in args.command:
            if command.strip().endswith("?"):
                print(client.query(command))
            else:
                client.write(command)
    return EXIT_OK


# ---------------------------------------------------------------- parser
def build_parser():
    parser = argparse.ArgumentParser(
        prog="powerdev",
        description="Drive programmable power devices over SCPI "
                    "(serial, TCP or the built-in simulator).")
    parser.add_argument("--version", action="version",
                        version="powerdev {}".format(__version__))
    parser.add_argument("-d", "--device", default=default_device(),
                        help="device URL, e.g. sim://psu, tcp://10.0.0.5:5025, "
                             "serial:///dev/ttyUSB0 "
                             "(default: $POWERDEV_DEVICE or sim://psu)")
    parser.add_argument("--timeout", type=float, default=2.0,
                        help="link timeout in seconds (default: 2.0)")
    parser.add_argument("--no-error-check", action="store_true",
                        help="skip the SYST:ERR? round trip after each command")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="trace every SCPI exchange on stderr")

    subparsers = parser.add_subparsers(dest="command")

    def add(name, function, help_text):
        sub = subparsers.add_parser(name, help=help_text, description=help_text)
        sub.set_defaults(func=function)
        return sub

    identify = add("id", cmd_id, "Identify the instrument and the chosen driver.")
    identify.add_argument("--json", action="store_true")

    add("drivers", cmd_drivers, "List the known instrument drivers.")

    status = add("status", cmd_status, "Show setpoints and live readings.")
    status.add_argument("-c", "--channel", action="append", type=int)
    status.add_argument("--no-measure", action="store_true",
                        help="show setpoints only, do not measure")
    status.add_argument("--json", action="store_true")

    setter = add("set", cmd_set, "Apply setpoints to one channel.")
    setter.add_argument("-c", "--channel", type=int, default=1)
    setter.add_argument("-V", "--voltage", type=float)
    setter.add_argument("-I", "--current", type=float, help="current limit")
    setter.add_argument("--ovp", type=float, help="over-voltage protection level")
    setter.add_argument("--ocp", type=float, help="over-current protection level")
    group = setter.add_mutually_exclusive_group()
    group.add_argument("--on", action="store_true", help="enable the output after setting")
    group.add_argument("--off", action="store_true", help="disable the output after setting")

    on = add("on", cmd_on, "Enable outputs (all channels by default).")
    on.add_argument("-c", "--channel", action="append", type=int)
    off = add("off", cmd_off, "Disable outputs (all channels by default).")
    off.add_argument("-c", "--channel", action="append", type=int)

    measure = add("measure", cmd_measure, "Read voltage, current and power once.")
    measure.add_argument("-c", "--channel", action="append", type=int)
    measure.add_argument("--json", action="store_true")

    monitor = add("monitor", cmd_monitor, "Log readings over time to the console or a file.")
    monitor.add_argument("-c", "--channel", action="append", type=int)
    monitor.add_argument("-i", "--interval", type=float, default=1.0,
                         help="seconds between samples (default: 1.0)")
    monitor.add_argument("-t", "--duration", type=float,
                         help="stop after this many seconds")
    monitor.add_argument("-n", "--count", type=int, help="stop after this many samples")
    monitor.add_argument("-o", "--output", help="write the log to this file")
    monitor.add_argument("--format", choices=("csv", "jsonl"),
                         help="log format (default: from the file extension)")
    monitor.add_argument("--stats", action="store_true",
                         help="print a min/max/mean/energy summary at the end")
    monitor.add_argument("-q", "--quiet", action="store_true",
                         help="do not echo samples to stdout")

    run = add("run", cmd_run, "Execute a JSON/YAML power sequence.")
    run.add_argument("sequence", help="path to the sequence file")
    run.add_argument("--json", action="store_true", help="emit the report as JSON")
    run.add_argument("--continue-on-fail", action="store_true",
                     help="keep going after a failing step")
    run.add_argument("--no-shutdown", action="store_true",
                     help="leave the outputs energised when the run ends")

    scpi = add("scpi", cmd_scpi, "Send raw SCPI commands (queries print their reply).")
    scpi.add_argument("command", nargs="+")

    return parser


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return EXIT_ERROR
    # ``run`` prefers the device in the sequence file unless -d was given.
    args.device_given = any(a == "-d" or a == "--device" or a.startswith("--device=")
                            for a in argv)
    try:
        return args.func(args)
    except SequenceError as exc:
        print("sequence error: {}".format(exc), file=sys.stderr)
        return EXIT_ERROR
    except PowerDevError as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return EXIT_ERROR
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())

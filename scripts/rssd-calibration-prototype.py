"""Fixed calibration calculation, invoked only by the isolated prototype.

Input is JSON data, never code. No user path is opened and no network is used.
"""
import json
import os
import platform
import resource
import subprocess
import sys


def restrict_resources():
    # macOS reserves a very large virtual address range at process startup.
    # Bound additional address space rather than setting a misleading 128 MiB
    # absolute limit that is already below the interpreter's virtual size.
    if sys.platform == 'darwin':
        current = int(subprocess.check_output(
            ['/bin/ps', '-o', 'vsz=', '-p', str(os.getpid())],
            text=True, timeout=1,
        ).strip()) * 1024
        address_limit = current + 128 * 1024 * 1024
    else:
        address_limit = 256 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (address_limit, address_limit))
    resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    address_current = resource.getrlimit(resource.RLIMIT_AS)
    cpu_current = resource.getrlimit(resource.RLIMIT_CPU)
    if address_current != (address_limit, address_limit) or cpu_current != (3, 3):
        raise RuntimeError('The requested process limits were not applied')
    return {'addressSpaceLimitBytes': address_limit, 'cpuSeconds': 3}


def main():
    limits = restrict_resources()
    data = json.load(sys.stdin)
    predictions = data['predictedProbabilities']
    outcomes = data['observedOutcomes']
    count = data['binCount']
    groups = [[] for _ in range(count)]
    for probability, outcome in zip(predictions, outcomes):
        groups[min(int(probability * count), count - 1)].append((probability, outcome))
    bins = []
    for index, group in enumerate(groups):
        if not group:
            continue
        n = len(group)
        events = sum(y for _, y in group)
        bins.append({'index': index, 'lower': index / count,
                     'upper': (index + 1) / count, 'sampleCount': n,
                     'events': events,
                     'meanPrediction': sum(p for p, _ in group) / n,
                     'observedProportion': events / n})
    brier = sum((p - y) ** 2 for p, y in zip(predictions, outcomes)) / len(predictions)
    result = {'algorithm': 'equal-width-binary-calibration-v1',
              'sampleCount': len(predictions), 'binCount': count,
              'bins': bins, 'brierScore': brier}
    # Standard declarative Vega-Lite chart specification, not a rendered image.
    # The points reference the same computed rows as the numerical receipt.
    chart = {'$schema': 'https://vega.github.io/schema/vega-lite/v5.json',
             'width': 400, 'height': 400,
             'layer': [
                 {'data': {'values': [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}]},
                  'mark': {'type': 'line', 'strokeDash': [5, 5], 'color': '#999'},
                  'encoding': {'x': {'field': 'x', 'type': 'quantitative', 'scale': {'domain': [0, 1]}},
                               'y': {'field': 'y', 'type': 'quantitative', 'scale': {'domain': [0, 1]}}}},
                 {'data': {'values': bins}, 'mark': {'type': 'point', 'filled': True, 'color': '#2463a0'},
                  'encoding': {'x': {'field': 'meanPrediction', 'type': 'quantitative',
                                     'title': 'Mean predicted probability', 'scale': {'domain': [0, 1]}},
                               'y': {'field': 'observedProportion', 'type': 'quantitative',
                                     'title': 'Observed proportion', 'scale': {'domain': [0, 1]}},
                               'tooltip': [{'field': 'sampleCount', 'type': 'quantitative'},
                                           {'field': 'events', 'type': 'quantitative'}]}}
             ]}
    json.dump({'result': result, 'chartSpec': chart,
               'environment': {'python': platform.python_version(),
                               'system': platform.system(), 'limits': limits}},
              sys.stdout, allow_nan=False, separators=(',', ':'))


if __name__ == '__main__':
    main()

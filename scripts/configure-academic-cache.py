#!/usr/bin/env python3
"""Add public-only calendar compression/cache rules to the existing vhost."""
import pathlib
import re

GZIP = '''        gzip on;
        gzip_types application/json application/javascript text/css application/xml image/svg+xml;
        gzip_min_length 1024;
        gzip_comp_level 5;
        gzip_vary on;
'''
# Entry assets the renderer stamps with ?h=<content hash> are immutable.
STAMPED = '''        set $scholay_cache "no-cache";
        if ($arg_h ~ "^[0-9a-f]{10}$") { set $scholay_cache "public, max-age=31536000, immutable"; }
        add_header Cache-Control $scholay_cache;
'''
MARKER = '    # Academic calendar: immutable payloads; revalidate the manifest.\n'
RULES = MARKER + '''    location = /calendar-index.json {
        try_files $uri =404;
        add_header Cache-Control "no-cache";
        add_header X-Robots-Tag "noindex";
    }
    location ~ "^/calendar-data/[a-f0-9]{64}\\.json$" {
        try_files $uri =404;
''' + GZIP + '''        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-Robots-Tag "noindex";
    }
'''

def configure(config):
    if MARKER in config:
        return config
    original = '    location / { try_files $uri $uri/ =404; }'
    if config.count(original) != 1:
        raise ValueError('Expected one public static location; inspect vhost before updating')
    config = config.replace(original, RULES + '    location / {\n        try_files $uri $uri/ =404;\n' + GZIP + STAMPED + '    }')
    for name in ('data.json', 'open-source.json'):
        pattern = r'(    location = /' + re.escape(name) + r' \{\n)'
        config, count = re.subn(pattern, lambda m: m[1] + GZIP, config)
        if count != 1:
            raise ValueError('Expected public export location for ' + name)
    return config

if __name__ == '__main__':
    path = pathlib.Path('/etc/nginx/conf.d/today.scholay.com.conf')
    path.write_text(configure(path.read_text()))

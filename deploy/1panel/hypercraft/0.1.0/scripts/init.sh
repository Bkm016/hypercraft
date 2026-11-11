#!/bin/bash

# Generated from official installation evidence:
# - https://github.com/Bkm016/hypercraft/blob/main/docker/Dockerfile.api (runtime user uid/gid 1000 writes /data and /services)

# Adjust host-mounted data directory permissions for the container runtime user.
if [ -d data ]; then
    chown -R 1000:1000 data
fi

# Adjust host-mounted data directory permissions for the container runtime user.
if [ -d services ]; then
    chown -R 1000:1000 services
fi

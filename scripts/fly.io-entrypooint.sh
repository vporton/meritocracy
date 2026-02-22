#!/bin/sh

set -e

# Not recommended on OverlayFS
# fallocate -l 512M /swapfile
# chmod 0600 /swapfile
# mkswap /swapfile
# echo 10 > /proc/sys/vm/swappiness
# swapon /swapfile
# echo 1 > /proc/sys/vm/overcommit_memory

exec npm start
#!/bin/sh
set -euo pipefail

yarn lint
yarn test:coverage

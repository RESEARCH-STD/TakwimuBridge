#!/bin/sh
set -e
QUARTO_VERSION="1.10.18"
curl -fsSL "https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-amd64.tar.gz" -o quarto.tar.gz
mkdir -p .quarto-bin
tar -xzf quarto.tar.gz -C .quarto-bin --strip-components=1
export PATH="$PWD/.quarto-bin/bin:$PATH"
quarto --version
quarto render

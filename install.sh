#!/bin/sh

PREFIX="${PREFIX:-$HOME/.local}"
OUTDIR="$PREFIX/bin"
ln -sf "$PWD/ts-repl.js" "$OUTDIR/ts-repl"

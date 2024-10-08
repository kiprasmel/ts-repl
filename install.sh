#!/bin/sh

PREFIX="${PREFIX:-$HOME/.local}"
OUTDIR="$PREFIX/bin"

ln -sfv "$PWD/ts-repl.js" "$OUTDIR/ts-repl"
ln -sfv "$PWD/ts-repl.js" "$OUTDIR/tsr"

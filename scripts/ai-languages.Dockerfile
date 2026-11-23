FROM gcc:15
RUN apt-get update && apt-get install -y --no-install-recommends \
    lua5.4 sqlite3 fp-compiler gnucobol swi-prolog-nox clisp emacs-nox \
    r-base-core racket ocaml ghc

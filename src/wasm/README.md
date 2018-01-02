```
$ rustup default nightly
$ rustup target add wasm32-unknown-unknown
$ cargo +nightly install -f cargo-web
$ cargo-web build --target-webasm
```

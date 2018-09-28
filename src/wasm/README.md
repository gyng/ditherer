```
$ rustup default nightly
$ rustup target add wasm32-unknown-unknown
$ cargo +nightly install wasm-bindgen-cli
$ cargo +nightly build --target wasm32-unknown-unknown --release

# In rgba2laba/

$ wasm-bindgen target/wasm32-unknown-unknown/release/rgba2laba.wasm --out-dir .
```

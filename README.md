# ditherer

![screenshot](screenshot.png)

More examples below

For all your online dithering needs.

* Dithering algorithms (Ordered, error-diffusing, and more)
* Video support
* Video recording support
* Colour palette
* Adaptive colour palette
* Palette extraction
* Pixel sorting
* (Real) glitching
* Convolve
* CRT emulation
* Brightness/contrast
* Bunch more other filters and features

## Examples

https://github.com/gyng/ditherer/assets/370496/a721ceb8-d10b-4650-9db1-850a067d7af4

[vid](https://github.com/gyng/ditherer/assets/370496/ded429eb-d14c-437e-8bbd-ac65e1d05465)

[vid](https://github.com/gyng/ditherer/assets/370496/20e03295-d6f7-4517-bf36-d66f823cbc54)

[vid](https://github.com/gyng/ditherer/assets/370496/cba67de2-8821-4123-98b0-9a71c1fc9bd7)

## TODO

* Cleanup (especially how realtime filtering is handled)
* More filters
* Better UI/UX

## Deploying

```
NODE_ENV=production  yarn deploy
```

or

```
NODE_ENV=production yarn build:prod
yarn deploy:prebuilt
```

or

```
NODE_ENV=production  yarn build:prod
git checkout gh-pages
rm commons.js index.html app.*.js
mv build/* .
git add .
git commit
git push origin gh-pages
```

## References

1. http://www.efg2.com/Lab/Library/ImageProcessing/DHALF.TXT
2. http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code/
3. http://www.easyrgb.com/en/math.php#text8

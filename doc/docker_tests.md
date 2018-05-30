# Running Tests in Docker Containers

If you want to run the tests in a Docker Container, you should consider modifying the `Dockerfile`.

An example `Dockerfile.test.dockerfile` that runs lint checks and all tests is provided and can be run using

```
docker-compose -f docker-compose.test.yml up --build
```

## Notes

The base image is changed from Alpine to `node:8.7.0`.

Some binaries used in the test (namely, Electron) are linked against `glibc` rather than
`musl` which is what Alpine includes.

## Dependencies

You will have to install additional dependencies as required by Electron.

  - xvfb
  - libgtk2.0
  - libxtst6
  - libxss1
  - libgconf2-4
  - libnss3
  - libasound2

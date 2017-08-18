# Running Tests in Docker Containers
If you want to run the tests in a Docker Container, you should consider modifying the `Dockerfile`.

## Base Image
You might want to change the base image to `node:7.5.0` which is based off `Ubuntu` rather than `Alpine`.

Primarily, many binaries used in the test (such as Electron, and Flow) are linked against `glibc` rather than
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

## Example Dockerfile

```dockerfile
FROM node:7.5.0

ARG YARN_VERSION=0.20.3
# These depdendencies below are installed for Electron which is used by Nightmare
RUN set -ex \
    && apt-get update \
    && apt-get install -y \
                          xvfb \
                          libgtk2.0 \
                          libxtst6 \
                          libxss1 \
                          libgconf2-4 \
                          libnss3 \
                          libasound2 \
    && npm install -g "yarn@${YARN_VERSION}" http-server

WORKDIR /usr/src/app

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile \
    && yarn check --integrity \
    && yarn cache clean

ARG NODE_ENV=production
COPY . /usr/src/app
RUN yarn build

EXPOSE 8080
CMD ["http-server", "build"]
```

FROM node:12.2.0-alpine as builder

# If package.json uses git, uncomment this
# RUN apk update \
#     && apk upgrade \
#     && apk add --no-cache git

WORKDIR /usr/src/app

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile \
    && yarn check --integrity \
    && yarn cache clean

ARG NODE_ENV=production
COPY . /usr/src/app
RUN yarn build:production



FROM nginx:1.15-alpine as runner

WORKDIR /usr/app

COPY --from=builder /usr/src/app/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /usr/src/app/dist /usr/app

CMD ["nginx", "-g", "daemon off;"]

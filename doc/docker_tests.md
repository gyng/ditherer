# Running Tests in Docker Containers

Tests are run using Docker.

`Dockerfile.test.dockerfile` runs lint checks and all tests. It can be run using

```
docker-compose -f docker-compose.test.yml up --build
```

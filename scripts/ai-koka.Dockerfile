FROM gcc:15
RUN curl -fsSL https://github.com/koka-lang/koka/releases/download/v3.2.9/koka-v3.2.9-linux-x64.tar.gz -o /tmp/koka.tar.gz \
    && echo "310459831a7c6fa6a0cd8e0e02d6b5b3b36441d5e7ce24168bda016cd2e95eee  /tmp/koka.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/koka.tar.gz -C /usr/local \
    && rm /tmp/koka.tar.gz

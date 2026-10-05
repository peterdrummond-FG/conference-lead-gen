# n8n + ffmpeg for CKH voice memos (AMR -> M4A before transcription).
# See README.md in this directory for why, the security trade-off, and the
# NODES_EXCLUDE setting that must accompany this image.
#
# Tested 2026-09-25 on n8nio/n8n 2.40.7 (Alpine 3.24): ffmpeg 8.1.2 with the
# amrnb/amrwb decoders and the aac encoder. Build with the tag you run today:
#   docker build --build-arg N8N_VERSION=<current tag> -t <registry>/n8n-ffmpeg:<tag> .
ARG N8N_VERSION=latest
FROM n8nio/n8n:${N8N_VERSION}

USER root
# The official image ships without apk. Restore it from the Alpine release the
# base image is built on (n8n's documented method), then install ffmpeg. If a
# future base moves to a newer Alpine, change 3.24 to match
# (grep PRETTY /etc/os-release in the base image).
COPY --from=alpine:3.24 /sbin/apk /sbin/apk
COPY --from=alpine:3.24 /lib/apk /lib/apk
COPY --from=alpine:3.24 /usr/lib/libapk* /usr/lib/
COPY --from=alpine:3.24 /etc/apk /etc/apk
# Fail the build rather than ship an ffmpeg that can't do the job.
RUN apk add --no-cache ffmpeg \
 && ffmpeg -hide_banner -decoders | grep -q ' amrnb ' \
 && ffmpeg -hide_banner -encoders | grep -q ' aac '
USER node

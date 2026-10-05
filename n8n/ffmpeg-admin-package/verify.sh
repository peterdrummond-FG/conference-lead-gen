#!/bin/sh
# Run inside the n8n container (as the user n8n runs as):
#   docker exec -it <n8n-container> sh /path/to/verify.sh
# or copy it in first:  docker cp verify.sh <n8n-container>:/tmp/verify.sh
set -e
echo "1. AMR decoders (expect amrnb and amrwb):"
ffmpeg -hide_banner -decoders | grep -E ' amrnb | amrwb '
echo "2. AAC encoder (expect one line):"
ffmpeg -hide_banner -encoders | grep ' aac '
echo "3. /tmp/ckh-voice is writable:"
mkdir -p /tmp/ckh-voice && touch /tmp/ckh-voice/.t && rm /tmp/ckh-voice/.t && echo ok
echo "4. Test conversion with the exact CKH settings (mono, 16 kHz, AAC 32k):"
ffmpeg -nostdin -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=2" \
  -ac 1 -ar 16000 -c:a aac -b:a 32k /tmp/ckh-voice/verify.m4a
test -s /tmp/ckh-voice/verify.m4a && echo ok
rm -f /tmp/ckh-voice/verify.m4a
echo "5. Cleanup command works (the sweep uses find -mmin and -delete):"
touch /tmp/ckh-voice/.old && find /tmp/ckh-voice -type f -mmin +60 -delete && echo ok
rm -f /tmp/ckh-voice/.old
echo "ALL CHECKS PASSED"

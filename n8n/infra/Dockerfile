# Custom n8n image for the CKH Connect migration.
#
# Adds two npm packages the stock n8n image doesn't ship, both required by
# the workflow design (see the migration plan, "Infra layout"):
#   - sharp: image cropping/resizing for process-cards/locate-cards. Chosen
#     over shelling out to ImageMagick via an Execute Command node because
#     crop coordinates here are numbers derived from LLM output, and a
#     library call removes the shell-metacharacter injection class entirely.
#   - zod: runs local-agent/schemas.mjs's validation logic (ported to
#     n8n/schemas/) inside n8n Code nodes, preserving the exact cross-field
#     .refine() invariants (e.g. the fabricated-match guard) rather than
#     reimplementing them as workflow-canvas branching.
#
# Verify during Stage 4 (process-cards) that this sharp/libvips build
# actually decodes real-world HEIC photos from event phones — if not, the
# documented fallback is ImageMagick + libheif via Execute Command, with
# array-form arguments only, never string-interpolated shell.

FROM n8nio/n8n:latest

USER root
RUN npm install --prefix /usr/local/lib/node_modules/n8n sharp zod
USER node

# Code nodes sandbox require() to an allowlist by default. Keep this list
# exactly as narrow as what's actually used — it applies to every Code node
# in the instance, not just the ones in this project's workflows.
ENV NODE_FUNCTION_ALLOW_EXTERNAL=sharp,zod

#!/bin/sh
# Copies the extension over to the folder Chrome loads it from (D:\WorldView).
# Run it after each change, then click the reload button on the extension's
# card in chrome://extensions.
rm -rf /d/WorldView && cp -r /d/Projets/wplace-worldview/extension /d/WorldView && echo "synced: D:\WorldView"

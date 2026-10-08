# Runtime audio supplied for xongkoro

`xongkoro_wingbeat_trimmed.wav` was supplied by the user for the xongkoro mount feature.
It is copied unchanged from the supplied file: stereo PCM16, 48 kHz, 0.66 seconds.
No external license or third-party attribution was supplied; no license is inferred.

SHA-256: `aa6ba4ac30d2cb3d40a6a136b0d5f6a092fffc50503bb520a9df9ef36deba9be`.

`SoundManager` imports the local file with a Vite URL so Web and Desktop package the
same sound. Playback follows the source flight animation's actual downstroke;
standing, death, inaudible distance, scene suspension and disposal stop playback.

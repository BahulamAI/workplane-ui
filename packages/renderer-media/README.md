# `renderer-media` — placeholder

Image, audio, video, artifact-download, and job-progress blocks.

**Not implemented.** Scheduled for M4.

The contracts it must honour are already defined in
`packages/core/src/host.ts` (`ArtifactResolver`, `JobProvider`, `Job`) and
`packages/core/src/document.ts` (`ArtifactDescriptor`):

- Artifacts are referenced by opaque id. An expiring signed URL is resolved
  just in time and never persisted.
- A completed render job may update its own block while the user is elsewhere,
  but it must not overwrite a newly edited scene or auto-play audio.
- An artifact produced from an earlier input fingerprint is retained and
  labelled stale. It is not silently refreshed, and it does not pretend the
  old movie changed when the assumptions did.
- Deleting a placeholder and cancelling a job are distinct actions.

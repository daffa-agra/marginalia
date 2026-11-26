// Stub: Marginalia reads EPUB only (see design, §16 non-goals).
// foliate's makeBook dynamically imports this module when it sniffs a PDF.
export async function makePDF() {
    throw new Error('PDF is not supported \u2014 Marginalia reads DRM-free EPUB only')
}

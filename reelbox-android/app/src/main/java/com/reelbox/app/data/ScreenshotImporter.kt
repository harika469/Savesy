package com.reelbox.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.reelbox.app.domain.OcrLine
import com.reelbox.app.domain.ScreenshotParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Keeps a small copy of the user's own screenshot as the card thumbnail. It never leaves the phone. */
class ThumbStore(private val context: Context) {
    suspend fun save(reelId: Long, uri: Uri): String? = withContext(Dispatchers.IO) {
        try {
            val resolver = context.contentResolver
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (bounds.outWidth / sample > 1080) sample *= 2
            val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return@withContext null
            val file = File(File(context.filesDir, "thumbs").apply { mkdirs() }, "$reelId.jpg")
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }
            Uri.fromFile(file).toString()
        } catch (_: Exception) {
            null
        }
    }

    fun delete(url: String?) {
        if (url != null && url.startsWith("file:")) runCatching { File(Uri.parse(url).path.orEmpty()).delete() }
    }
}

/** Reads a screenshot on the phone (ML Kit, offline) and fills the reel's creator, caption, tags and thumbnail. */
class ScreenshotImporter(private val context: Context, private val repo: ReelRepository, private val thumbs: ThumbStore = ThumbStore(context)) {
    /** @return a short message for the user describing what was found. */
    suspend fun import(reelId: Long, uris: List<Uri>): String {
        if (uris.isEmpty()) return "No screenshot chosen"
        val parsed = try {
            uris.map { uri -> val (lines, height) = read(uri); ScreenshotParser.parse(lines, height) }
        } catch (_: Exception) { return "Couldn't read that image" }
        val info = ScreenshotParser.merge(parsed)
        val thumb = thumbs.save(reelId, uris.first())
        val outcome = repo.applyScreenshot(reelId, info, thumb)
        if (outcome == null || (info.isEmpty && thumb == null)) return "No text found in that screenshot"
        val found = buildList {
            info.handle?.let { add(it) }
            if (info.caption.isNotBlank()) add(if (uris.size > 1) "caption from ${uris.size} screenshots" else "caption")
            if (info.hashtags.isNotEmpty()) add("${info.hashtags.size} hashtag${if (info.hashtags.size == 1) "" else "s"}")
        }
        return if (found.isEmpty()) "Saved the screenshot, but found no text to read" else "Found " + found.joinToString(", ")
    }

    private suspend fun read(uri: Uri): Pair<List<OcrLine>, Int> = withContext(Dispatchers.Default) {
        val image = InputImage.fromFilePath(context, uri)
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
            suspendCancellableCoroutine { cont ->
                recognizer.process(image)
                    .addOnSuccessListener { text ->
                        val lines = text.textBlocks.flatMap { it.lines }.map { OcrLine(it.text, it.boundingBox?.top ?: 0, it.boundingBox?.left ?: 0) }
                        cont.resume(lines to image.height)
                    }
                    .addOnFailureListener { cont.resumeWithException(it) }
            }
        } finally {
            recognizer.close()
        }
    }
}

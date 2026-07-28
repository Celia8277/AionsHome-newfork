package com.ysclaude.app

import android.content.Context
import android.os.Bundle
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

class ShizukuShellUserService() : IShizukuShellService.Stub() {
  @Suppress("UNUSED_PARAMETER") constructor(context: Context) : this()

  override fun execute(command: String, timeoutMs: Long, maxOutputChars: Int): Bundle {
    val startedAt = System.currentTimeMillis()
    val limit = maxOutputChars.coerceIn(1000, 1_000_000)
    val process = ProcessBuilder("/system/bin/sh", "-c", command).start()
    val stdout = ByteArrayOutputStream()
    val stderr = ByteArrayOutputStream()
    val outThread = copyLimited(process.inputStream, stdout, limit)
    val errThread = copyLimited(process.errorStream, stderr, limit)
    val completed = process.waitFor(timeoutMs.coerceIn(1000, 600_000), TimeUnit.MILLISECONDS)
    if (!completed) process.destroyForcibly()
    outThread.join(1000); errThread.join(1000)
    return Bundle().apply {
      putString("stdout", stdout.toString(StandardCharsets.UTF_8.name()).take(limit))
      putString("stderr", stderr.toString(StandardCharsets.UTF_8.name()).take(limit))
      putInt("exitCode", if (completed) process.exitValue() else -1)
      putBoolean("timedOut", !completed)
      putBoolean("truncated", stdout.size() >= limit || stderr.size() >= limit)
      putLong("durationMs", System.currentTimeMillis() - startedAt)
    }
  }

  private fun copyLimited(input: java.io.InputStream, output: ByteArrayOutputStream, limit: Int) = Thread {
    input.use {
      val buffer = ByteArray(4096)
      while (output.size() < limit) {
        val count = it.read(buffer, 0, minOf(buffer.size, limit - output.size()))
        if (count < 0) break
        output.write(buffer, 0, count)
      }
    }
  }.apply { start() }

  override fun destroy() { System.exit(0) }
}

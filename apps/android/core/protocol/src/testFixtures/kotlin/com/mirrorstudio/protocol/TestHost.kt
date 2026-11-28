package com.mirrorstudio.protocol

import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Lanza un anfitrion real (apps/desktop/src/main/meeting*.ts) con Node para probar el protocolo de punta a punta.
 * Necesita Node y `npm install` hecho en la raiz del repositorio.
 */
class TestHost private constructor(private val process: Process, val port: Int, val code: String) : AutoCloseable {
    override fun close() {
        runCatching { process.outputStream.close() }
        if (!process.waitFor(5, TimeUnit.SECONDS)) process.destroyForcibly()
    }

    companion object {
        private val isWindows = System.getProperty("os.name").lowercase().contains("win")

        val repoRoot: File by lazy {
            var d: File? = File(System.getProperty("user.dir")).absoluteFile
            while (d != null && !File(d, "packages/protocol/package.json").exists()) d = d.parentFile
            d ?: error("No encuentro la raiz del repositorio de MirrorStudio")
        }

        private val bundle: File by lazy {
            val out = File(repoRoot, "apps/android/build/test-host/test-host.cjs")
            out.parentFile.mkdirs()
            val cmd = listOf("npx", "--no-install", "esbuild", "apps/android/tools/test-host.ts", "--bundle", "--platform=node",
                "--format=cjs", "--log-level=error", "--outfile=${out.absolutePath}")
            val p = ProcessBuilder(if (isWindows) listOf("cmd", "/c") + cmd else cmd)
                .directory(repoRoot).redirectErrorStream(true).start()
            val log = p.inputStream.bufferedReader().readText()
            check(p.waitFor(120, TimeUnit.SECONDS) && p.exitValue() == 0) { "No se pudo empaquetar el anfitrion de prueba: $log" }
            out
        }

        fun start(): TestHost {
            val p = ProcessBuilder("node", bundle.absolutePath).directory(repoRoot).redirectError(ProcessBuilder.Redirect.INHERIT).start()
            val line = p.inputStream.bufferedReader().readLine() ?: error("El anfitrion de prueba no arranco")
            val obj = Wire.json.parseToJsonElement(line) as kotlinx.serialization.json.JsonObject
            val port = obj["port"].toString().toInt()
            val code = obj["code"].toString().trim('"')
            return TestHost(p, port, code)
        }
    }
}

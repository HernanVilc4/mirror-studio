package com.mirrorstudio

import kotlinx.coroutines.*
import java.net.*

/**
 * Finds desktops on whatever network the phone is on (Wi-Fi, hotspot host or client, ethernet adapter).
 * It probes TCP 47800 across the /24 of every local IPv4 interface, so it needs no mDNS/multicast support
 * and works on hotspots. Cost: ~254 short connects per interface, once per scan.
 */
object Discovery {
    const val PORT = 47800

    private fun localPrefixes(): List<String> = NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .map { it.hostAddress!!.substringBeforeLast('.') }
        .distinct()

    suspend fun scan(): List<String> = withContext(Dispatchers.IO) {
        val own = NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }.mapNotNull { it.hostAddress }.toSet()
        localPrefixes().flatMap { prefix -> (1..254).map { "$prefix.$it" } }
            .filter { it !in own }
            .map { ip -> async { if (open(ip)) ip else null } }
            .awaitAll().filterNotNull()
    }

    private fun open(ip: String): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(ip, PORT), 400); true }
    } catch (_: Exception) { false }
}

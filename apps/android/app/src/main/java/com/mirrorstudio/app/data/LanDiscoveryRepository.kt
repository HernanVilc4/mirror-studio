package com.mirrorstudio.app.data

import com.mirrorstudio.app.domain.DiscoveryRepository
import com.mirrorstudio.app.domain.NearbyMeeting
import com.mirrorstudio.network.MeetingDiscovery
import com.mirrorstudio.protocol.PROTOCOL_VERSION
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Recorre las interfaces locales con IPv4 privada: el Wi-Fi y tambien el punto de acceso del propio telefono
 * (`swlan0`, `ap0`), que Android no expone como red activa. Se saltan los datos moviles.
 */
class LanDiscoveryRepository(private val discovery: MeetingDiscovery) : DiscoveryRepository {

    override suspend fun scan(): List<NearbyMeeting> = coroutineScope {
        val nets = withContext(Dispatchers.IO) { localNetworks() }
        nets.map { (ip, prefix) -> async { discovery.scan(ip, prefix) } }.awaitAll().flatten()
            .distinctBy { it.ip to it.port }
            .map { NearbyMeeting(it.ip, it.port, it.name, it.host, it.participants, it.version == PROTOCOL_VERSION) }
    }

    override suspend fun probe(ip: String, port: Int): NearbyMeeting? =
        discovery.probe(ip, port)?.let { NearbyMeeting(it.ip, it.port, it.name, it.host, it.participants, it.version == PROTOCOL_VERSION) }

    private fun localNetworks(): List<Pair<String, Int>> = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback && !it.name.startsWith("rmnet") && !it.name.startsWith("ccmni") && !it.name.startsWith("dummy") }
            .flatMap { ni -> ni.interfaceAddresses.filter { it.address is Inet4Address && it.address.isSiteLocalAddress } }
            .map { it.address.hostAddress!! to it.networkPrefixLength.toInt() }
            .distinct()
    }.getOrDefault(emptyList())
}

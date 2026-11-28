package com.mirrorstudio.app.di

import com.mirrorstudio.app.data.ClassroomEngine
import com.mirrorstudio.app.data.KtorMeetingRepository
import com.mirrorstudio.app.domain.ClassroomRepository
import com.mirrorstudio.app.presentation.classroom.ClassroomViewModel
import com.mirrorstudio.app.data.LanDiscoveryRepository
import com.mirrorstudio.app.data.SharedJoinPreferences
import com.mirrorstudio.app.data.media.RtcMedia
import com.mirrorstudio.app.domain.DiscoveryRepository
import com.mirrorstudio.app.domain.JoinMeetingUseCase
import com.mirrorstudio.app.domain.JoinPreferences
import com.mirrorstudio.app.domain.MeetingLink
import com.mirrorstudio.app.domain.MeetingRepository
import com.mirrorstudio.app.presentation.home.HomeViewModel
import com.mirrorstudio.app.presentation.join.JoinViewModel
import com.mirrorstudio.app.presentation.link.LinkViewModel
import com.mirrorstudio.app.presentation.room.RoomViewModel
import com.mirrorstudio.network.MeetingDiscovery
import com.mirrorstudio.network.meetingHttpClient
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.viewModel
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.binds
import org.koin.dsl.module

val appModule = module {
    single { CoroutineScope(SupervisorJob() + Dispatchers.Default) }
    single { meetingHttpClient(OkHttp) }
    single { MeetingDiscovery(get()) }
    single { RtcMedia(androidContext()) }
    single { ClassroomEngine(androidContext(), get()) }
    single { KtorMeetingRepository(get(), get(), get(), get()) } binds arrayOf(MeetingRepository::class, ClassroomRepository::class)
    single<DiscoveryRepository> { LanDiscoveryRepository(get()) }
    single<JoinPreferences> { SharedJoinPreferences(androidContext()) }
    factory { JoinMeetingUseCase(get(), get()) }
    viewModelOf(::HomeViewModel)
    viewModelOf(::JoinViewModel)
    viewModel { (link: MeetingLink) -> LinkViewModel(link, get(), get(), get(), get()) }
    viewModelOf(::RoomViewModel)
    viewModelOf(::ClassroomViewModel)
}

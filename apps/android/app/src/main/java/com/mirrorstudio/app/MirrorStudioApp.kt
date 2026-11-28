package com.mirrorstudio.app

import android.app.Application
import com.mirrorstudio.app.di.appModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class MirrorStudioApp : Application() {
    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidContext(this@MirrorStudioApp)
            modules(appModule)
        }
    }
}

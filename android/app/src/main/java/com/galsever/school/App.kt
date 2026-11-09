package com.galsever.school

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.galsever.school.net.Api
import com.galsever.school.net.Session
import com.galsever.school.work.Checker
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** App-wide singletons: one HTTP client with the gate cookie for the API, images and files. */
class App : Application(), SingletonImageLoader.Factory {
    lateinit var session: Session
    lateinit var http: OkHttpClient
    lateinit var api: Api

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = Session(this)
        http = OkHttpClient.Builder()
            .cookieJar(session)
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(5, TimeUnit.MINUTES)
            .build()
        api = Api(http)
        Checker.setup(this)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { http })) }
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.2).build() }
            .diskCache { DiskCache.Builder().directory(cacheDir.resolve("img")).maxSizeBytes(128L * 1024 * 1024).build() }
            .crossfade(true)
            .build()

    companion object {
        lateinit var instance: App
            private set
    }
}

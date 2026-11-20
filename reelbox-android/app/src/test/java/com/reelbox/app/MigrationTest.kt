package com.reelbox.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reelbox.app.data.AppDatabase
import com.reelbox.app.data.MIGRATION_1_2
import com.reelbox.app.data.MIGRATION_2_3
import com.reelbox.app.data.MIGRATION_3_4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A phone that already has Reelbox v1 data must upgrade without losing a single reel. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MigrationTest {
    @Test fun versionOneDatabaseUpgradesAndKeepsItsReels() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "migration-test.db"
        context.deleteDatabase(name)

        // Exactly the tables Room created for version 1.
        object : SQLiteOpenHelper(context, name, null, 1) {
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `reels` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `permalink` TEXT NOT NULL, `normalizedUrl` TEXT NOT NULL, `platform` TEXT NOT NULL, `platformId` TEXT, `title` TEXT NOT NULL, `creatorHandle` TEXT, `creatorName` TEXT, `caption` TEXT NOT NULL, `thumbnailUrl` TEXT, `hashtags` TEXT NOT NULL, `audioName` TEXT, `status` TEXT NOT NULL, `folderId` INTEGER NOT NULL, `note` TEXT NOT NULL, `enrichState` TEXT NOT NULL, `isUnavailable` INTEGER NOT NULL, `createdAt` INTEGER NOT NULL, `lastOpenedAt` INTEGER)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_reels_normalizedUrl` ON `reels` (`normalizedUrl`)")
                db.execSQL("CREATE TABLE IF NOT EXISTS `folders` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `emoji` TEXT NOT NULL, `parentId` INTEGER, `isSystem` INTEGER NOT NULL)")
                db.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)")
                db.execSQL("INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, 'aa5fb3d79963ddf858f9448d1254f1cd')")
                db.execSQL("INSERT INTO folders (id, name, emoji, parentId, isSystem) VALUES (1, 'Inbox', '📥', NULL, 1)")
                db.execSQL("INSERT INTO reels (id, permalink, normalizedUrl, platform, platformId, title, creatorHandle, creatorName, caption, thumbnailUrl, hashtags, audioName, status, folderId, note, enrichState, isUnavailable, createdAt, lastOpenedAt) VALUES (7, 'https://www.instagram.com/reel/OLD1/', 'ig:OLD1', 'INSTAGRAM', 'OLD1', 'Old reel', '@someone', NULL, 'An old caption #recipe', NULL, 'recipe', NULL, 'TO_TRY', 1, 'my note', 'MANUAL', 0, 1000, NULL)")
            }
            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
        }.writableDatabase.close()

        val db = Room.databaseBuilder(context, AppDatabase::class.java, name).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4).allowMainThreadQueries().build()
        val reel = runBlocking { db.reels().get(7) }!!
        assertEquals("Old reel", reel.title)
        assertEquals("my note", reel.note)
        assertEquals("@someone", reel.creatorHandle)
        assertNull(reel.aiJson)
        assertNull(reel.aiHash)
        assertNull(reel.likes)
        assertNull(reel.comments)
        assertNull(reel.views)
        assertNull(reel.eventDate)
        assertNull(reel.remindAt)
        org.junit.Assert.assertFalse(reel.dateDismissed)
        db.close()
    }
}

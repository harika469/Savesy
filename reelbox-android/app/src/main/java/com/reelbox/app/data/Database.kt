package com.reelbox.app.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface ReelDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(reel: ReelEntity): Long

    @Update
    suspend fun update(reel: ReelEntity)

    @Delete
    suspend fun delete(reel: ReelEntity)

    @Query("SELECT * FROM reels ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<ReelEntity>>

    @Query("SELECT * FROM reels WHERE id = :id")
    fun observe(id: Long): Flow<ReelEntity?>

    @Query("SELECT * FROM reels WHERE id = :id")
    suspend fun get(id: Long): ReelEntity?

    @Query("SELECT * FROM reels WHERE normalizedUrl = :key LIMIT 1")
    suspend fun findByKey(key: String): ReelEntity?

    @Query("SELECT * FROM reels WHERE enrichState = 'PENDING'")
    suspend fun pending(): List<ReelEntity>
}

@Dao
interface FolderDao {
    @Insert
    suspend fun insert(folder: FolderEntity): Long

    @Query("SELECT * FROM folders ORDER BY isSystem DESC, id ASC")
    fun observeAll(): Flow<List<FolderEntity>>

    @Query("SELECT * FROM folders ORDER BY isSystem DESC, id ASC")
    suspend fun getAll(): List<FolderEntity>

    @Query("SELECT * FROM folders WHERE name = :name LIMIT 1")
    suspend fun findByName(name: String): FolderEntity?
}

@Database(entities = [ReelEntity::class, FolderEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun reels(): ReelDao
    abstract fun folders(): FolderDao

    companion object {
        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "reelbox.db").build()
    }
}

using MediaHub.MediaAppData.SqlLite;
using MediaHub.WebServices.MediaApp.DatabaseViews;
using Microsoft.EntityFrameworkCore;

namespace MediaHub.WebServices.MediaApp;

internal class MediaAppViews
{
    public static List<View> MakeViews(IDbContextFactory<MediaHubDbContext> dbContextFactory)
    {
        var views = new List<View>();
        views.AddRange(MediaAppDatabaseViews.MakeViews(dbContextFactory));
        return views;
    }
}

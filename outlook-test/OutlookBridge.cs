using System;
using System.Runtime.InteropServices;

internal static class OutlookBridge
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 0) return 0;
        var utf8 = new System.Text.UTF8Encoding(false);
        Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
        Console.SetError(new System.IO.StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
        try { RunBoardCommand(args); return 0; }
        catch (COMException ex) {
            switch(ex.ErrorCode) {
            case unchecked((int)0x80010001):
            case unchecked((int)0x8001010A): Console.Error.WriteLine("Outlook ist beschäftigt. Bitte danach erneut versuchen."); break;
            case unchecked((int)0x80010108):
            case unchecked((int)0x800706BA):
            case unchecked((int)0x80040200):
                Console.Error.WriteLine("Die Verbindung zu Outlook wurde unterbrochen. Bitte Outlook öffnen und erneut laden."); break;
            case unchecked((int)0x8004010F): Console.Error.WriteLine("Mail oder Ordner nicht mehr vorhanden. Bitte aktualisieren."); break;
            default: Console.Error.WriteLine(ex.Message); break;
            }
            return 1;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
    }

    private static void RunBoardCommand(string[] args)
    {
        var type = Type.GetTypeFromProgID("Outlook.Application");
        if (type == null) throw new InvalidOperationException("Klassisches Outlook für Windows wird benötigt.");
        bool start = args.Length == 1 && args[0] == "--connect";
        dynamic app;
        try { app = Marshal.GetActiveObject("Outlook.Application"); }
        catch (COMException) {
            if (!start && System.Diagnostics.Process.GetProcessesByName("OUTLOOK").Length==0)
                throw new InvalidOperationException("Outlook ist geschlossen. Bitte klassisches Outlook starten.");
            app = Activator.CreateInstance(type);
        }
        dynamic ns = app.GetNamespace("MAPI");
        dynamic inbox = ns.GetDefaultFolder(6);
        if (start) {
            if ((int)app.Explorers.Count==0) inbox.Display();
            return;
        }
        var serializer = new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength=64*1024*1024 };
        var commands = new BoardCommands((object)ns, (object)inbox, System.Globalization.CultureInfo.CurrentCulture.TextInfo.ListSeparator, Environment.GetEnvironmentVariable("KANBAN_STATUS_PREFIX"));
        var result = commands.Execute(args, json => serializer.Deserialize<string[]>(json));
        if (result != null) Console.Write(serializer.Serialize(result));
    }
}
